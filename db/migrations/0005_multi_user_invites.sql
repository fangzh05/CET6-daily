CREATE TABLE "invite_redemptions" (
	"invite_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_redemptions_invite_id_user_id_pk" PRIMARY KEY("invite_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_code_unique" UNIQUE("code"),
	CONSTRAINT "invite_max_uses" CHECK ("invites"."max_uses" between 1 and 50),
	CONSTRAINT "invite_used_bounds" CHECK ("invites"."used_count" >= 0 and "invites"."used_count" <= "invites"."max_uses")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "user_account_status" CHECK ("users"."status" in ('active','disabled'));--> statement-breakpoint
-- Multi-user activation. One statement/transaction: the invite row is locked,
-- so a code is consumed exactly once even under concurrent redemption, and a
-- non-admin users row can only be created by redeeming a usable code.
CREATE OR REPLACE FUNCTION cet6_redeem_invite(p_identity text, p_email text, p_code text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE u users; inv invites;
BEGIN
  SELECT * INTO u FROM users WHERE identity=p_identity;
  IF FOUND THEN RETURN jsonb_build_object('status','existing','user',jsonb_build_object('id',u.id,'email',u.email,'account_status',u.status)); END IF;
  IF EXISTS(SELECT 1 FROM users WHERE lower(email)=lower(p_email)) THEN RAISE EXCEPTION 'EMAIL_ALREADY_REGISTERED'; END IF;
  SELECT * INTO inv FROM invites WHERE code=p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;
  IF inv.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'INVITE_REVOKED'; END IF;
  IF inv.expires_at IS NOT NULL AND inv.expires_at<=now() THEN RAISE EXCEPTION 'INVITE_EXPIRED'; END IF;
  IF inv.used_count>=inv.max_uses THEN RAISE EXCEPTION 'INVITE_EXHAUSTED'; END IF;
  INSERT INTO users(identity,email) VALUES(p_identity,p_email) ON CONFLICT(identity) DO NOTHING RETURNING * INTO u;
  IF NOT FOUND THEN SELECT * INTO u FROM users WHERE identity=p_identity; RETURN jsonb_build_object('status','existing','user',jsonb_build_object('id',u.id,'email',u.email,'account_status',u.status)); END IF;
  INSERT INTO invite_redemptions(invite_id,user_id) VALUES(inv.id,u.id);
  UPDATE invites SET used_count=used_count+1 WHERE id=inv.id;
  RETURN jsonb_build_object('status','redeemed','user',jsonb_build_object('id',u.id,'email',u.email,'account_status',u.status));
END $$;
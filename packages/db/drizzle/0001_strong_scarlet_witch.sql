CREATE UNIQUE INDEX "balances_account_asset_uidx" ON "balances" USING btree ("account_id","asset");--> statement-breakpoint
CREATE UNIQUE INDEX "deadman_state_tenant_uidx" ON "deadman_state" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_tenant_asset_uidx" ON "positions" USING btree ("tenant_id","asset");
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { CredentialsService } from "./credentials.service";
import {
  CredentialsController,
  GmailCallbackController,
  InternalCredentialsController,
} from "./credentials.controller";
import { GmailCredential } from "./entities/gmail-credential.entity";

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([GmailCredential])],
  providers: [CredentialsService],
  controllers: [
    CredentialsController,
    GmailCallbackController,
    InternalCredentialsController,
  ],
  exports: [CredentialsService],
})
export class CredentialsModule {}

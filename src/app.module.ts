import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthModule } from "./modules/auth/auth.module";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module";
import { FlowsModule } from "./modules/flows/flows.module";
import { ExecutionsModule } from "./modules/executions/executions.module";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";
import { N8nBridgeModule } from "./modules/n8n-bridge/n8n-bridge.module";
import { TemplatesModule } from "./modules/templates/templates.module";
import { CredentialsModule } from "./modules/credentials/credentials.module";
import { PlansModule } from "./modules/plans/plans.module";
import { IntegrationsModule } from "./modules/integrations/integrations.module";
import { CommonModule } from "./common/common.module";
import { AppController } from "./app.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        url: config.get<string>("DATABASE_URL"),
        autoLoadEntities: true,
        synchronize: false,
        logging: config.get("NODE_ENV") === "development",
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    CommonModule,
    AuthModule,
    WorkspacesModule,
    FlowsModule,
    ExecutionsModule,
    WebhooksModule,
    N8nBridgeModule,
    TemplatesModule,
    CredentialsModule,
    PlansModule,
    IntegrationsModule,
  ],
  controllers: [AppController],
  providers: [
    // JWT guard global — rotas públicas usam @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}

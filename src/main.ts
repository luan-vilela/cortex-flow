import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || "http://localhost:3003",
    credentials: true,
  });

  // Validação global
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger
  const config = new DocumentBuilder()
    .setTitle("Cortex Flow API")
    .setDescription("Automation management system powered by n8n")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port, "0.0.0.0");
  console.log(`🚀 Cortex Flow API running on http://0.0.0.0:${port}`);
  console.log(`📖 Swagger: http://localhost:${port}/api`);
}

bootstrap();

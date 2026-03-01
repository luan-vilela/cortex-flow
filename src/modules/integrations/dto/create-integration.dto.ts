import { IsString, IsOptional, IsObject, IsIn, Length } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateIntegrationDto {
  @ApiProperty({ example: "Meu Email Blast" })
  @IsString()
  @Length(3, 200)
  name: string;

  @ApiProperty({ example: "email-blast", description: "Slug do template" })
  @IsString()
  templateSlug: string;

  @ApiProperty({ example: "email", enum: ["email", "whatsapp", "custom"] })
  @IsIn(["email", "whatsapp", "custom"])
  channel: string;

  @ApiPropertyOptional({ example: "550e8400-e29b-41d4-a716-446655440000" })
  @IsOptional()
  @IsString()
  credentialId?: string;

  @ApiPropertyOptional({
    example: { subject: "Olá {{name}}!", body: "Mensagem padrão..." },
    description:
      "Variáveis padrão do template. Suportam {{variáveis}} dinâmicas.",
  })
  @IsOptional()
  @IsObject()
  defaultVars?: Record<string, any>;
}

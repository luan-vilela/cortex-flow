import {
  IsString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsInt,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class InstallTemplateDto {
  @ApiProperty({ example: 1, description: "ID do template a instalar" })
  @IsInt()
  templateId: number;

  @ApiProperty({
    example: {
      CRON_EXPRESSION: "0 8 * * 1-5",
      EMAIL_SUBJECT: "Novidades da semana",
      RECIPIENTS_JSON: '[{"email":"a@b.com","message":"Olá!"}]',
      CREDENTIAL_ID: "12",
    },
    description: "Valores para substituir os placeholders do template",
  })
  @IsObject()
  params: Record<string, string>;

  @ApiPropertyOptional({
    example: "Campanha Semanal",
    description: "Nome personalizado para o flow criado",
  })
  @IsOptional()
  @IsString()
  flowName?: string;
}

import {
  IsArray,
  IsOptional,
  IsObject,
  IsEmail,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class RecipientDto {
  @ApiProperty({ example: "joao@empresa.com" })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: "João Silva" })
  @IsOptional()
  @IsString()
  name?: string;

  /** Campos adicionais para {{variáveis}} no template */
  [key: string]: any;
}

export class TriggerIntegrationDto {
  @ApiProperty({
    type: [RecipientDto],
    description:
      "Lista de destinatários. Cada campo vira uma {{variável}} no template.",
    example: [{ email: "joao@empresa.com", name: "João" }],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipientDto)
  recipients: RecipientDto[];

  @ApiPropertyOptional({
    description:
      "Variáveis globais que sobrescrevem o defaultVars da integração",
    example: { subject: "Assunto customizado" },
  })
  @IsOptional()
  @IsObject()
  vars?: Record<string, any>;
}

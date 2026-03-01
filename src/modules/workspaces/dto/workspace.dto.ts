import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  IsInt,
  IsIn,
  MinLength,
  MaxLength,
  Matches,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";

export class CreateWorkspaceDto {
  @ApiProperty({ example: "Minha Empresa" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: "minha-empresa",
    description: "Identificador único (letras, números e hífens)",
  })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, {
    message: "Slug deve conter apenas letras minúsculas, números e hífens",
  })
  slug: string;
}

export class UpdateWorkspaceDto extends PartialType(CreateWorkspaceDto) {}

export class LinkCrmDto {
  @ApiProperty({ description: "ID do workspace no Cortex Control" })
  @IsInt()
  crmWorkspaceId: number;

  @ApiProperty({ example: "http://localhost:3000" })
  @IsUrl()
  crmApiUrl: string;

  @ApiProperty({ description: "API Key do Cortex Control" })
  @IsString()
  @IsNotEmpty()
  crmApiKey: string;
}

export class ConfigureN8nDto {
  @ApiPropertyOptional({ example: "http://localhost:5678" })
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  n8nBaseUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  n8nApiKey?: string;
}

export class InviteMemberDto {
  @ApiProperty({ example: "membro@empresa.com" })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ enum: ["admin", "operator", "viewer"], default: "operator" })
  @IsIn(["admin", "operator", "viewer"])
  role: "admin" | "operator" | "viewer";
}

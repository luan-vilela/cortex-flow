import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsArray,
  IsObject,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";

export class CreateFlowDto {
  @ApiProperty({ example: "Notificar novo lead" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: "Envia email quando novo lead é criado" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: ["manual", "webhook", "cron", "event"],
    default: "manual",
  })
  @IsOptional()
  @IsIn(["manual", "webhook", "cron", "event"])
  triggerType?: "manual" | "webhook" | "cron" | "event";

  @ApiPropertyOptional({
    example: "0 8 * * 1-5",
    description: "Necessário se triggerType = cron",
  })
  @IsOptional()
  @IsString()
  cronExpression?: string;

  @ApiPropertyOptional({ example: ["crm", "leads"] })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ example: "⚡" })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ example: "#6366f1" })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({
    description: "Definição JSON completa do workflow n8n (opcional)",
  })
  @IsOptional()
  @IsObject()
  n8nDefinition?: any;

  @ApiPropertyOptional({ description: "Nodes do editor visual (React Flow)" })
  @IsOptional()
  @IsArray()
  nodes?: object[];

  @ApiPropertyOptional({ description: "Edges do editor visual (React Flow)" })
  @IsOptional()
  @IsArray()
  edges?: object[];
}

export class UpdateFlowDto extends PartialType(CreateFlowDto) {}

export class SaveNodesDto {
  @ApiProperty({ description: "Nodes do editor visual (React Flow)" })
  @IsArray()
  nodes: object[];

  @ApiProperty({ description: "Edges do editor visual (React Flow)" })
  @IsArray()
  edges: object[];
}

export class ExecuteFlowDto {
  @ApiPropertyOptional({
    description: "Dados de entrada para a execução",
    example: { clienteId: "123", evento: "novo_lead" },
  })
  @IsOptional()
  @IsObject()
  inputData?: Record<string, any>;
}

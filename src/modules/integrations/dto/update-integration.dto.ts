import { IsString, IsOptional, IsObject, IsIn } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateIntegrationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: ["active", "paused"] })
  @IsOptional()
  @IsIn(["active", "paused"])
  status?: "active" | "paused";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  credentialId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  defaultVars?: Record<string, any>;
}

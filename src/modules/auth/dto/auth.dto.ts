import { IsEmail, IsString, MinLength, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RegisterDto {
  @ApiProperty({ example: "João Silva" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: "joao@empresa.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "senha123", minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;
}

export class LoginDto {
  @ApiProperty({ example: "joao@empresa.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "senha123" })
  @IsString()
  @MinLength(1)
  password: string;
}

export class SsoValidateDto {
  @ApiProperty({ description: "JWT assinado pelo Cortex Control" })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ description: "ID do workspace no Cortex Control" })
  workspaceId?: number;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

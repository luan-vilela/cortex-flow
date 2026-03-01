import { Controller, Post, Body, Get, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { RegisterDto, LoginDto, SsoValidateDto } from "./dto/auth.dto";
import { Public } from "../../common/decorators/public.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post("register")
  @Public()
  @ApiOperation({ summary: "Criar conta no Cortex Flow" })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post("login")
  @Public()
  @ApiOperation({ summary: "Login com email e senha" })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("sso/validate")
  @Public()
  @ApiOperation({
    summary: "Validar token SSO do Cortex Control",
    description:
      "Recebe um JWT assinado pelo Cortex Control e emite token próprio do Cortex Flow",
  })
  validateSso(@Body() dto: SsoValidateDto) {
    return this.authService.validateSsoToken(dto);
  }

  @Get("me")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Retorna perfil do usuário autenticado" })
  me(@CurrentUser() user: any) {
    return this.authService.getProfile(user.sub);
  }
}

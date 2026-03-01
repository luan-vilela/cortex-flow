import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import { User } from "./entities/user.entity";
import { RegisterDto, LoginDto, SsoValidateDto } from "./dto/auth.dto";

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.userRepo.findOne({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException("E-mail já cadastrado");

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.userRepo.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
      isVerified: true,
    });
    const saved = await this.userRepo.save(user);
    return this.generateTokens(saved);
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException("Credenciais inválidas");
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Credenciais inválidas");

    if (!user.isActive) throw new UnauthorizedException("Conta desativada");

    await this.userRepo.update(user.id, { lastLoginAt: new Date() });
    return this.generateTokens(user);
  }

  async validateSsoToken(dto: SsoValidateDto) {
    const secret = this.config.get<string>("CRM_SSO_SECRET");
    if (!secret) {
      throw new BadRequestException(
        "Integração SSO não configurada neste servidor",
      );
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(dto.token, { secret });
    } catch {
      throw new UnauthorizedException("Token SSO inválido ou expirado");
    }

    // Busca ou cria o usuário baseado no CRM
    let user = await this.userRepo.findOne({
      where: { crmUserId: payload.sub, crmSource: "cortex-control" },
    });

    if (!user) {
      // Tenta por email (caso usuário já exista sem link CRM)
      user = await this.userRepo.findOne({ where: { email: payload.email } });
      if (user) {
        await this.userRepo.update(user.id, {
          crmUserId: payload.sub,
          crmSource: "cortex-control",
        });
      } else {
        // Cria novo usuário via SSO
        user = await this.userRepo.save(
          this.userRepo.create({
            name: payload.name || payload.email,
            email: payload.email,
            crmUserId: payload.sub,
            crmSource: "cortex-control",
            isVerified: true,
          }),
        );
      }
    }

    if (!user.isActive) throw new UnauthorizedException("Conta desativada");

    await this.userRepo.update(user.id, { lastLoginAt: new Date() });
    return this.generateTokens(user);
  }

  async getProfile(userId: string) {
    return this.userRepo.findOne({
      where: { id: userId },
      select: ["id", "name", "email", "avatarUrl", "createdAt"],
    });
  }

  private generateTokens(user: User) {
    const payload = { sub: user.id, email: user.email, name: user.name };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get("JWT_SECRET"),
      expiresIn: this.config.get("JWT_EXPIRES_IN") || "7d",
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get("JWT_SECRET"),
      expiresIn: this.config.get("JWT_REFRESH_EXPIRES_IN") || "30d",
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
      },
    };
  }
}

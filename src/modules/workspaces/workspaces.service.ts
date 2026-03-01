import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Workspace } from "./entities/workspace.entity";
import { WorkspaceMember } from "./entities/workspace-member.entity";
import { User } from "../auth/entities/user.entity";
import {
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  LinkCrmDto,
  ConfigureN8nDto,
  InviteMemberDto,
} from "./dto/workspace.dto";
import { NodeRedBridgeService } from "../node-red-bridge/node-red-bridge.service";
import axios from "axios";

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Workspace)
    private workspaceRepo: Repository<Workspace>,
    @InjectRepository(WorkspaceMember)
    private memberRepo: Repository<WorkspaceMember>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private nodeRedBridge: NodeRedBridgeService,
  ) {}

  async create(dto: CreateWorkspaceDto, ownerId: string): Promise<Workspace> {
    const existing = await this.workspaceRepo.findOne({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException("Slug já em uso");

    const workspace = await this.workspaceRepo.save(
      this.workspaceRepo.create({ ...dto, ownerId }),
    );

    // Adiciona o criador como admin
    await this.memberRepo.save(
      this.memberRepo.create({
        workspaceId: workspace.id,
        userId: ownerId,
        role: "admin",
      }),
    );

    return workspace;
  }

  async findAllForUser(userId: string): Promise<Workspace[]> {
    const members = await this.memberRepo.find({
      where: { userId },
      relations: ["workspace"],
    });
    return members.map((m) => m.workspace).filter(Boolean);
  }

  async findOne(id: string): Promise<Workspace> {
    const ws = await this.workspaceRepo.findOne({ where: { id } });
    if (!ws) throw new NotFoundException("Workspace não encontrado");
    return ws;
  }

  async update(id: string, dto: UpdateWorkspaceDto): Promise<Workspace> {
    await this.findOne(id);
    await this.workspaceRepo.update(id, dto);
    return this.findOne(id);
  }

  async delete(id: string, userId: string): Promise<void> {
    const ws = await this.findOne(id);
    if (ws.ownerId !== userId) {
      throw new ForbiddenException("Apenas o dono pode excluir o workspace");
    }
    await this.workspaceRepo.delete(id);
  }

  async linkCrm(id: string, dto: LinkCrmDto): Promise<Workspace> {
    await this.findOne(id);
    await this.workspaceRepo.update(id, {
      crmWorkspaceId: dto.crmWorkspaceId,
      crmApiUrl: dto.crmApiUrl,
      crmApiKey: dto.crmApiKey,
    });
    return this.findOne(id);
  }

  async configureN8n(id: string, dto: ConfigureN8nDto): Promise<Workspace> {
    await this.findOne(id);
    // Ignora campos vazios para não sobrescrever valores existentes
    const update: Partial<Workspace> = {};
    if (dto.n8nBaseUrl) update.n8nBaseUrl = dto.n8nBaseUrl;
    if (dto.n8nApiKey) update.n8nApiKey = dto.n8nApiKey;
    if (Object.keys(update).length > 0) {
      await this.workspaceRepo.update(id, update);
    }
    return this.findOne(id);
  }

  async getN8nStatus(id: string) {
    const ws = await this.workspaceRepo.findOne({
      where: { id },
      select: ["id", "n8nBaseUrl", "n8nApiKey", "n8nTagId"],
    });
    if (!ws) throw new NotFoundException("Workspace não encontrado");

    try {
      const ok = await this.nodeRedBridge.healthCheck();
      return { connected: ok, reason: ok ? undefined : "Node-RED inacessível" };
    } catch (e) {
      return { connected: false, reason: e.message };
    }
  }

  async getCrmStatus(id: string) {
    const ws = await this.workspaceRepo.findOne({
      where: { id },
      select: ["id", "crmApiUrl", "crmApiKey", "crmWorkspaceId"],
    });
    if (!ws) throw new NotFoundException("Workspace não encontrado");
    if (!ws.crmApiUrl) return { connected: false, reason: "CRM não vinculado" };

    try {
      await axios.get(`${ws.crmApiUrl}/health`, {
        headers: { Authorization: `Bearer ${ws.crmApiKey}` },
        timeout: 5000,
      });
      return { connected: true, crmUrl: ws.crmApiUrl };
    } catch (e) {
      return { connected: false, reason: e.message };
    }
  }

  async inviteMember(id: string, dto: InviteMemberDto, inviterId: string) {
    await this.findOne(id);
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user)
      throw new NotFoundException("Usuário não encontrado com este e-mail");

    const existing = await this.memberRepo.findOne({
      where: { workspaceId: id, userId: user.id },
    });
    if (existing) {
      await this.memberRepo.update(existing.id, { role: dto.role });
      return { message: "Papel atualizado", userId: user.id };
    }

    await this.memberRepo.save(
      this.memberRepo.create({
        workspaceId: id,
        userId: user.id,
        role: dto.role,
        invitedBy: inviterId,
      }),
    );
    return { message: "Membro adicionado", userId: user.id };
  }

  async getMembers(id: string) {
    return this.memberRepo.find({
      where: { workspaceId: id },
      relations: ["user"],
    });
  }

  async removeMember(
    workspaceId: string,
    memberId: string,
    requesterId: string,
  ) {
    const ws = await this.findOne(workspaceId);
    const member = await this.memberRepo.findOne({
      where: { id: memberId, workspaceId },
    });
    if (!member) throw new NotFoundException("Membro não encontrado");
    if (member.userId === ws.ownerId) {
      throw new ForbiddenException(
        "Não é possível remover o dono do workspace",
      );
    }
    await this.memberRepo.delete(memberId);
  }
}

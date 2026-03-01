import {
  Controller,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { IntegrationsService } from "./integrations.service";
import { TriggerIntegrationDto } from "./dto/trigger-integration.dto";

@ApiTags("integrations-trigger")
@Controller("integrations")
export class IntegrationsTriggerController {
  constructor(private readonly service: IntegrationsService) {}

  /**
   * Endpoint público. Sistemas externos chamam este endpoint com lista de destinatários.
   * POST /integrations/trigger/:token
   * Body: { recipients: [{email, name, ...}], vars?: {subject, body, ...} }
   */
  @Post("trigger/:token")
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Disparar integração em modo bulk (endpoint público)",
    description:
      "Trigger externo com lista de destinatários. " +
      "O sistema faz fan-out e envia 1 mensagem por recipient de forma assíncrona. " +
      "Retorna imediatamente com o batchId para rastreamento.",
  })
  trigger(@Param("token") token: string, @Body() dto: TriggerIntegrationDto) {
    return this.service.triggerBulk(token, dto);
  }
}

import {
  Controller,
  Post,
  Body,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { WebhooksService } from "./webhooks.service";
import { Public } from "../../common/decorators/public.decorator";

@ApiTags("webhooks")
@Controller()
export class WebhooksController {
  constructor(private service: WebhooksService) {}

  // Endpoint público — trigger externo por token
  @Post("webhooks/:token")
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Disparar flow via webhook token (endpoint público)",
    description:
      "Endpoint público para sistemas externos dispararem flows. " +
      "O token é gerado automaticamente na criação do flow.",
  })
  triggerByToken(
    @Param("token") token: string,
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
  ) {
    return this.service.triggerByToken(token, payload, headers);
  }

  // Endpoint privado — callback do Node-RED com resultado de execução
  @Post("internal/nodered-callback")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Callback interno do Node-RED com resultado de execução",
    description:
      "Endpoint chamado pelo Node-RED quando uma execução termina. " +
      "Configure via HTTP Request node no final dos flows.",
  })
  nodeRedCallback(@Body() body: any) {
    return this.service.handleNodeRedCallback(body);
  }
}

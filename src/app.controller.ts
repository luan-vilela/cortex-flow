import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { Public } from "./common/decorators/public.decorator";

@ApiTags("health")
@Controller()
export class AppController {
  @Get("health")
  @Public()
  @ApiOperation({ summary: "Health check" })
  health() {
    return {
      status: "ok",
      service: "cortex-flow",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    };
  }
}

import { BadRequestException, Body, Controller, Post } from "@nestjs/common";

import type { EstimateCostRequest, EstimateCostResponse } from "./estimation.models";
import { EstimationService, EstimationValidationError } from "./estimation.service";

@Controller("costs")
export class EstimationController {
  constructor(private readonly estimation: EstimationService) {}

  @Post("estimate")
  async estimate(@Body() request: EstimateCostRequest): Promise<EstimateCostResponse> {
    try {
      return await this.estimation.estimate(request);
    } catch (error: unknown) {
      if (error instanceof EstimationValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}

import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ROUTE_METADATA = "alterx:public-route";

export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE_METADATA, true);

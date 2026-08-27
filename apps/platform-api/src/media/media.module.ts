import { Module } from "@nestjs/common";
import {
  resolveImageGenProvider,
  resolveMediaObjectStorageProvider,
  resolveSpeechToTextProvider,
  resolveTextToSpeechProvider,
} from "@alterx/adapters";
import type { ObjectStorageProvider } from "@alterx/shared-clients";
import { MediaController } from "./media.controller";
import { MediaExceptionFilter } from "./media-exception.filter";
import { MediaService } from "./media.service";
import {
  IMAGE_GEN_PROVIDER,
  MEDIA_OBJECT_STORAGE,
  SPEECH_TO_TEXT_PROVIDER,
  TEXT_TO_SPEECH_PROVIDER,
} from "./tokens";

@Module({
  controllers: [MediaController],
  providers: [
    {
      provide: MEDIA_OBJECT_STORAGE,
      useFactory: () => resolveMediaObjectStorageProvider(),
    },
    {
      provide: IMAGE_GEN_PROVIDER,
      useFactory: (objects: ObjectStorageProvider) => resolveImageGenProvider(objects),
      inject: [MEDIA_OBJECT_STORAGE],
    },
    {
      provide: TEXT_TO_SPEECH_PROVIDER,
      useFactory: (objects: ObjectStorageProvider) => resolveTextToSpeechProvider(objects),
      inject: [MEDIA_OBJECT_STORAGE],
    },
    {
      provide: SPEECH_TO_TEXT_PROVIDER,
      useFactory: (objects: ObjectStorageProvider) => resolveSpeechToTextProvider(objects),
      inject: [MEDIA_OBJECT_STORAGE],
    },
    MediaService,
    MediaExceptionFilter,
  ],
  exports: [MediaService],
})
export class MediaModule {}

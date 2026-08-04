import { describe, expect, it, vi } from "vitest";
import type { KycProvider } from "@alterx/shared-clients";
import type { ListingStatus } from "../marketplace/types";
import { PublisherService, PUBLISHING_TRANSITIONS } from "./publisher.service";

const tenantId = "ten_018f47a5-7b2c-7d10-8f11-1234567890ab";
const listingId = "lst_018f47a5-7b2c-7d10-8f11-1234567890ad";
const statuses = Object.keys(PUBLISHING_TRANSITIONS) as ListingStatus[];
const unusedKyc = {} as KycProvider;

function repository(current: ListingStatus, verificationStatus = "verified") {
  return {
    getPublisher: vi.fn().mockResolvedValue({ verificationStatus }),
    listingStatus: vi.fn().mockResolvedValue(current),
    transitionListing: vi.fn().mockImplementation(async (_tenantId: string, _listingId: string, target: ListingStatus) => target),
    reviewSubmission: vi.fn(), listPayouts: vi.fn(), earnings: vi.fn(),
  };
}

describe("PublisherService publishing pipeline", () => {
  it("allows every exact graph edge", async () => {
    for (const from of statuses) {
      for (const to of PUBLISHING_TRANSITIONS[from]) {
        const store = repository(from);
        const service = new PublisherService(store as never, unusedKyc);
        await expect(service.transitionListing(tenantId, listingId, to)).resolves.toEqual({ listingId, status: to });
        expect(store.transitionListing).toHaveBeenCalledWith(tenantId, listingId, to);
      }
    }
  });

  it("rejects every non-edge", async () => {
    for (const from of statuses) {
      for (const to of statuses.filter((status) => !PUBLISHING_TRANSITIONS[from].includes(status))) {
        const store = repository(from);
        const service = new PublisherService(store as never, unusedKyc);
        await expect(service.transitionListing(tenantId, listingId, to)).rejects.toMatchObject({ status: 409 });
        expect(store.transitionListing).not.toHaveBeenCalled();
      }
    }
  });

  it("requires verified publisher before submit", async () => {
    const store = repository("draft", "pending_review");
    const service = new PublisherService(store as never, unusedKyc);
    await expect(service.submitListing(tenantId, listingId)).rejects.toMatchObject({ status: 403 });
  });
});

# OLX PL real API readiness

This document tracks what MarketDesk can safely prepare before the OLX developer
application/OAuth credentials are approved.

## Current seller context

- Market: OLX Poland (`PL`).
- Seller account: user's personal verified OLX account.
- First live-test item: base AirPods 4.
- No OLX app credentials are stored in this repository.

## Safety rules

1. Keep `OLX_ADAPTER_MODE=stub` until an official OLX app/client is approved.
2. Keep `OLX_LIVE_PUBLISH_ENABLED=false` until a human explicitly approves the
   first real listing publish.
3. Never commit `OLX_CLIENT_SECRET`, access tokens, refresh tokens, account
   passwords, or screenshots containing credentials.
4. Use publish preview/dry-run first. Live publish must be a separate intentional
   step.

## Required OLX app values

When OLX developer/app access is approved, store these outside git (for example
in the deployment `.env` or the platform secret store):

```env
OLX_MARKET=PL
OLX_ADAPTER_MODE=real
OLX_API_BASE_URL=https://api.olx.pl/v1
OLX_CLIENT_ID=[REDACTED]
OLX_CLIENT_SECRET=[REDACTED]
OLX_REDIRECT_URI=https://<domain>/api/marketplaces/olx/oauth/callback
OLX_ACCESS_TOKEN=[REDACTED]
OLX_REFRESH_TOKEN=[REDACTED]
OLX_LIVE_PUBLISH_ENABLED=false
```

`OLX_ACCESS_TOKEN` / `OLX_REFRESH_TOKEN` are temporary placeholders for the first
transport probe. The production implementation should replace them with per-
workspace encrypted token storage plus refresh flow.

## Prepared in code

- Fetch-backed marketplace transport can be wired into the OLX adapter.
- Real transport is opt-in via `OLX_ADAPTER_MODE=real`.
- Live `POST /user/ads` is blocked unless `OLX_LIVE_PUBLISH_ENABLED=true`.
- Existing Product → Listing and publish-preview flows let us validate the final
  payload before attempting live publish.

## Remaining implementation after approval

- OAuth connect/callback endpoints.
- Encrypted per-workspace token storage and refresh-token rotation.
- Full OLX PL taxonomy/category/location/required-params mapping.
- Image upload flow and attachment IDs/URLs expected by OLX.
- Read-only account/profile probe to verify the token before any publish.
- Final live publish runbook with explicit human confirmation.

## AirPods 4 draft checklist

Collect before real preview:

- condition: new / like new / used;
- price in PLN;
- city/location;
- photos;
- box/receipt/warranty details;
- exact model (AirPods 4 basic, not ANC variant);
- contact/phone visibility preference if OLX requires it.

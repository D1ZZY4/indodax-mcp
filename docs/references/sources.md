# Source references

Use upstream documentation as the source of truth for exchange protocol behavior. Repository implementation claims must be checked against the code in this repository as well.

## Primary: official INDODAX API documentation

Repository: https://github.com/btcid/indodax-official-api-docs

Relevant documents:

- Trade API v2: https://github.com/btcid/indodax-official-api-docs/blob/master/INDODAX-TradeAPI-2.md
- Public REST: https://github.com/btcid/indodax-official-api-docs/blob/master/Public-RestAPI.md
- Market Data WebSocket: https://github.com/btcid/indodax-official-api-docs/blob/master/Marketdata-websocket.md
- Private WebSocket: https://github.com/btcid/indodax-official-api-docs/blob/master/Private-websocket.md

The current Trade API v2 document specifies the api.indodax.com base URL, HMAC-SHA256 signatures, form-encoded POST requests, query-string GET/DELETE requests, timestamp or nonce requirements, and current order/history endpoints.

The current Market Data WebSocket document specifies the production ws3 endpoint, token authentication, method 1 subscriptions, method 7 ping, and offset-based recovery.

The current Private WebSocket document uses a separately generated private token and a private-channel connection/subscription format. This differs from the market WebSocket message shape and must not be generalized across both sockets.

## Secondary: Context7

Context7 library mirror:

https://context7.com/btcid/indodax-official-api-docs/llms.txt?tokens=100000

Context7 is useful for retrieval and navigation, but the upstream official repository remains the primary reference when the two need to be reconciled.

## Documentation maintenance

When an exchange endpoint or protocol changes:

1. verify the official upstream document;
2. verify the current implementation;
3. update API mapping and the relevant architecture or risk notes;
4. add or update regression tests;
5. record material deviations in migration/deviations.md or the risk register.

Never invent an endpoint, signature algorithm, parameter, or rate limit.

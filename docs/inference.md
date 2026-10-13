# Inference providers and cost

Claude Code viewer mode is unchanged. These settings apply to the direct web
runner (`COUNCIL_RUNNER=api`). Configuration is read on startup; restart after
changing `.env`. No npm packages need installing. API keys stay on the server.

## OpenRouter budget setup

```bash
cp .env.openrouter.example .env
```

Set `OPENROUTER_API_KEY` in `.env`, then `npm start`. Open localhost:4730.
The supplied template sets:

```dotenv
COUNCIL_RUNNER=api
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your-key
INFERENCE_PROFILE=budget
JSON_OUTPUT_MODE=json_schema
```

Budget uses `google/gemini-2.5-flash-lite` for advisors and
`openai/gpt-4.1-mini` for the Chair. Both were present in OpenRouter's public
model catalogue with structured-output support when checked on 2026-10-13.
The app requests compatible endpoint routing for structured Chair calls.
Availability, endpoint support, and pricing can change.

Override either model independently with `SEAT_MODEL` and `CHAIR_MODEL`, using
OpenRouter model IDs (provider/model). Old explicit Anthropic model overrides
must be removed or changed when switching providers. The app does not silently
fall back to another model or provider.

## Anthropic, including cheaper inference

```dotenv
COUNCIL_RUNNER=api
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-key
INFERENCE_PROFILE=budget
```

| Provider | Profile | Advisor default | Chair default |
|---|---|---|---|
| Anthropic | standard | claude-sonnet-4-6 | claude-opus-4-6 |
| Anthropic | budget | claude-haiku-4-5 | claude-sonnet-4-6 |
| OpenRouter | standard | openai/gpt-4.1-mini | openai/gpt-4.1-mini |
| OpenRouter | budget | google/gemini-2.5-flash-lite | openai/gpt-4.1-mini |

Model overrides always take precedence over these presets.

## Local or hosted OpenAI-compatible server

The app uses `/chat/completions`, not OpenAI's Responses API. Configure the base
URL including `/v1`, exact model names, and the server's output capabilities.
For Ollama or another local server, first install and start the server and pull
models separately, then copy `.env.local.example` to `.env`. That example assumes
an installed `qwen3:8b` model; it is not automatically downloaded or evaluated.

```dotenv
COUNCIL_RUNNER=api
AI_PROVIDER=openai
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_ALLOW_NO_KEY=true
SEAT_MODEL=qwen3:8b
CHAIR_MODEL=qwen3:8b
INFERENCE_PROFILE=budget
JSON_OUTPUT_MODE=prompt
```

For hosted servers, set `OPENAI_API_KEY` and omit `OPENAI_ALLOW_NO_KEY`.
Keyless mode is restricted to loopback URLs. Set the actual model IDs served
by your endpoint; OpenAI-compatible mode has no guessed model defaults.
Your server needs streamed chat completions and enough context for character
brains, previous cards, and the Chair's instructions. Local inference can still
have hardware and electricity costs, and a small model may struggle with the
Chair protocol. Start with `npm run smoke` to test both JSON and streaming.

## Output compatibility

`JSON_OUTPUT_MODE` applies to OpenRouter/OpenAI-compatible Chair calls:

- `json_schema` (default): native strict JSON schema. Pick a compatible endpoint.
- `json_object`: request a JSON object and provide the full schema in the prompt.
- `prompt`: no `response_format` parameter; useful for servers without native
  JSON support. The schema still goes in the prompt.

Every mode validates the returned JSON against the app's schema before using it.
Malformed JSON, wrong field types, unknown seat keys, refusals, and incomplete
responses fail the council rather than producing a partially parsed verdict.
Only the Chair uses structured output; advisors stream the existing text cards.
Their option scores must be present before they can enter the scorecard.
`json_object` and `prompt` can be less reliable with small models. There is no
automatic paid repair call; change the mode or use a stronger Chair when needed.

## Control usage

Budget preselects Quick in the browser; you can still choose Full. Quick seats
up to four advisors and usually runs two rounds (a third can be required by a
large disagreement or likely ruin risk). With Munger enabled, a full council
makes 28 calls: 24 advisor calls plus four Chair calls. Quick normally makes
11 calls, or 16 when a vote round is needed.

Budget also sets `BRAIN_CONTEXT=compact`: it loads the hot sheet, voice notes,
and complete source register rather than every brain file. It reduces input
size at the cost of less framework, position, and story detail. It does not
truncate source records. Set `BRAIN_CONTEXT=full` to restore full context while
still using cheaper models, or choose compact with the standard profile.

HTTP 429 and transient server failures retry up to four requests for compatible
providers; authentication, credit, and compatibility errors fail immediately.
Interrupted streams and bad JSON are not replayed automatically. Set
`INFERENCE_TIMEOUT_MS` (1000–600000, default 120000) for slow local models.
The token counter accepts provider usage data; if an endpoint omits usage,
counts are incomplete. The app does not enforce a dollar budget or estimate
fees. Set spending limits at your provider account if you need a hard cap.

## Verification

`npm test` runs offline provider tests with mocked HTTP responses, including
stream boundaries, usage, schema validation, errors, and council persistence.
`npm run smoke` makes two real calls to your selected provider: a structured
Chair response and a streamed advisor card. It bills hosted API accounts.

References: [OpenRouter streaming](https://openrouter.ai/docs/api/reference/streaming),
[structured output](https://openrouter.ai/docs/guides/features/structured-outputs),
and [model catalogue](https://openrouter.ai/models).

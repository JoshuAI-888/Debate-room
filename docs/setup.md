# Setup and running

Requires Node.js 20+. No npm dependencies or install step.

```bash
git clone https://github.com/JoshuAI-888/Debate-room.git
cd Debate-room
npm test
npm start
```

Open http://localhost:4730 on the machine running the server. The server binds
127.0.0.1. On a remote machine use port forwarding, for example
`ssh -L 4730:127.0.0.1:4730 user@host`, then open that URL locally.
Click Past sessions to replay the three included examples and export PDFs.

## Run a fresh debate through Claude Code

Install Claude Code separately and sign in. In a second terminal in this repo:

```bash
claude
```

Then enter `/roast-room` followed by the decision, options, revenue/cash/team,
constraints, success target, and your current preference. The Chair gathers
context, selects weights, runs opening arguments, challenges disagreement,
and collects final votes. Weighted option scores and downside flags support
the verdict. The local web app watches the session files and plays the debate;
it does not make AI calls in viewer mode. A full council normally has three
rounds; `--quick` uses fewer seats and two rounds.

## Run directly from the web app

```bash
cp .env.example .env
```

Edit `.env` locally:

```dotenv
ANTHROPIC_API_KEY=your-key
COUNCIL_RUNNER=api
SEAT_MODEL=claude-sonnet-4-6
CHAIR_MODEL=claude-opus-4-6
```

Restart `npm start` and enter a decision in the room. This bills your Anthropic
account. Set model IDs your account supports; both environment variables and
`.env` overrides are read. `npm run smoke` makes a paid single-seat API test.
`npm test` runs offline checks without a key. A full default council uses about
25 calls; more enabled seats increase that count. Never commit `.env`.

Session files are stored in `sessions/`, ignored by git except included examples.
PDF export happens in the browser. Keep a backup of your sessions and character
brains. Character configuration and research steps are in
[character-research.md](character-research.md).

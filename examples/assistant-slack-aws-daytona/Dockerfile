# Consumer Lambda as a container image, on the AWS Lambda Node 22 base (which
# includes the Runtime Interface Client). The handler shells out to the Flue CLI
# (`flue run --id`) so the agent runs through the normal app — hence we ship the
# full project + node_modules + the built dist.
FROM public.ecr.aws/lambda/nodejs:22

# App lands at the Lambda task root.
WORKDIR ${LAMBDA_TASK_ROOT}

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Project sources discovered at runtime by `flue run` (AGENTS.md, src/, config),
# the skills, and the handler.
COPY flue.config.ts tsconfig.json AGENTS.md ./
COPY src ./src
COPY .agents ./.agents
COPY handler.ts ./

# Build the Flue server bundle (dist/) inside the image so `sam build` /
# `docker build` is self-contained — no pre-build step. @flue/cli is a prod dep,
# so it's present after --omit=dev.
RUN node_modules/.bin/flue build --target node

# The Lambda Node RIC resolves `handler.handler` to a .mjs/.js module — it does
# NOT type-strip a .ts entrypoint. Transpile handler.ts → handler.mjs at build
# time with esbuild (bundled via Flue's deps). (`flue run`, invoked from the
# handler at runtime, still reads the .ts project sources fine — Node strips
# those when it runs them directly.)
RUN node_modules/.bin/esbuild handler.ts --format=esm --platform=node --target=node22 --outfile=handler.mjs

# CMD is <file>.<exportedFn> per the Lambda Node base image contract.
CMD [ "handler.handler" ]

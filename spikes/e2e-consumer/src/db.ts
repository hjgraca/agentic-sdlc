import { sqlite } from '@flue/runtime/node';
// Durable across processes (and `flue run`'s ephemeral runtimes) because the
// file outlives each process — exactly the condition flue run needs to resume
// persisted state. In prod this line becomes postgres(process.env.DATABASE_URL).
export default sqlite('./data/flue.db');

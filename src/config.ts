// Load .env into process.env. Built into Node 20.12+, so no dotenv package.
try {
  process.loadEnvFile();
} catch {
  // No .env file yet: fine until a script asks for a value below.
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

// Getters, so a script only fails on the values it actually uses
// (the database scripts don't need a Gemini key).
export const config = {
  get databaseUrl() {
    return required('DATABASE_URL');
  },
  get googleApiKey() {
    return required('GOOGLE_API_KEY');
  },
};

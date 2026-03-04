// courtesy GPT 5.2
import { loadConfig } from 'c12';
import { z } from 'zod';

const ConfigSchema = z.object({
  auth: z.object({
    access_token_expiration: z.coerce
      .number()
      .int()
      .min(0)
      .max(3600)
      .default(120),
    access_token_secret: z.string().min(32),
    refresh_token_secret: z.string().min(32),
    refresh_token_expiration: z.coerce.number().int().min(0).default(3600),
    refresh_cookie_name: z.string().min(1).default('refresh_token'),
    bcrypt_salt_rounds: z.coerce.number().int().min(4).max(14).default(10),
  }),
  db: z.object({
    filename: z.string().min(1),
  }),
  routes: z.object({
    api_prefix: z.string().min(1).startsWith('/').default('/api'),
    user_prefix: z.string().min(1).startsWith('/').default('/user'),
  }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export async function getConfig(): Promise<AppConfig> {
  const env =
    (process.env.NODE_ENV as 'development' | 'test' | 'production') ??
    'development';

  const { config } = await loadConfig({
    cwd: `${process.cwd()}/config`,
    configFile: env,
    rcFile: false,
    packageJson: false,
    dotenv: true,
  });

  return ConfigSchema.parse(config);
}

export const config = await getConfig();

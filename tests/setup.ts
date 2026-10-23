import { vi } from 'vitest';

// No test may reach a real SMTP server, even when credentials end up in the environment.
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: vi.fn().mockResolvedValue({}), close: vi.fn() }) } }));

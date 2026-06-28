import { z } from 'zod';

export const openDmSchema = z.object({ userId: z.string().min(1) });

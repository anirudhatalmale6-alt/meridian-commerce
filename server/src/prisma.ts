import { PrismaClient } from '@prisma/client';
import { isTest } from './env.js';

export const prisma = new PrismaClient({
  log: isTest ? [] : ['warn', 'error'],
});

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

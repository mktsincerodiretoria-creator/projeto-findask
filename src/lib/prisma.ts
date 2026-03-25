import { PrismaClient } from "@/generated/prisma";

const globalForPrisma = globalThis as unknown as {
  _prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!globalForPrisma._prisma) {
      globalForPrisma._prisma = new PrismaClient();
    }
    return Reflect.get(globalForPrisma._prisma, prop);
  },
});

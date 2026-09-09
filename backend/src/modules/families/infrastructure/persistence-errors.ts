import { Prisma } from '../../../generated/prisma/client'

export const prismaPersistenceErrors = {
  isUniqueConstraint(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  },
}

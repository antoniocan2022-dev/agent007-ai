import { db } from './db'

export async function resolveStripeCustomer(input: { userId: string; email?: string; name?: string }): Promise<string | null> {
  const email = input.email?.trim().toLowerCase()
  const name = input.name?.trim()
  if (!email) return null

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stripe-customer\n${input.userId}\n${email}`}))`

    const existing = await tx.customer.findFirst({
      where: { userId: input.userId, email },
      select: { id: true },
    })
    if (existing) {
      await tx.customer.update({
        where: { id: existing.id },
        data: {
          status: 'customer',
          ...(name ? { name } : {}),
        },
      })
      return existing.id
    }

    const created = await tx.customer.create({
      data: {
        userId: input.userId,
        name: name || email,
        email,
        status: 'customer',
      },
      select: { id: true },
    })
    return created.id
  })
}

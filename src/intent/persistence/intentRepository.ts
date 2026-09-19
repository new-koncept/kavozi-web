import { db } from '../../location/persistence/db'

export const intentRepository = {
  list: () => db.intents.orderBy('updatedAt').toArray(),
  get: (id: string) => db.intents.get(id),
}

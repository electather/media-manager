import { z } from 'zod'
import type { PreferenceEngine } from '../../preferences/engine'

const inputSchema = z.object({
  action: z
    .enum(['get_profile', 'get_preferences'])
    .describe('Account action to perform'),
  userId: z.string().describe('User ID'),
})

export function accountTool(preferences: PreferenceEngine) {
  return {
    name: 'ent_account' as const,
    description: 'Retrieve account information and preference profile.',
    inputSchema,
    async handler(input: z.infer<typeof inputSchema>) {
      switch (input.action) {
        case 'get_profile':
        case 'get_preferences': {
          const profile = await preferences.getProfile(input.userId)
          return { profile }
        }
      }
    },
  }
}

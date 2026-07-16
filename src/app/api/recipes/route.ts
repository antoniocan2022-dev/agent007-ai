/**
 * /api/recipes — UPGRADE #88
 * List, view, or run tool recipes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { toolRecipeEngine } from '@/lib/max-autonomy-engine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'list'
  const recipeId = url.searchParams.get('recipe_id')
  const result = await toolRecipeEngine({ action, recipe_id: recipeId })
  return NextResponse.json({
    ok: result.ok,
    preview: result.preview,
    result: result.result,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const result = await toolRecipeEngine(body)
  return NextResponse.json({
    ok: result.ok,
    preview: result.preview,
    result: result.result,
  })
}

"""Recipe Book backend.

Stores the shared recipe list and forwards shopping items to a
hard-coded Google Keep checklist. See README.md for setup.
"""

import logging
import os
import secrets

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import keep
import storage

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Recipe Book")

# The native app doesn't need CORS, but this lets the Expo web build (used
# for development/testing) talk to the server too. Auth is the API key.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_api_key(x_api_key: str = Header(default="")) -> None:
    expected = os.environ.get("API_KEY", "")
    if not expected:
        raise HTTPException(500, "API_KEY is not configured on the server")
    if not secrets.compare_digest(x_api_key, expected):
        raise HTTPException(401, "Invalid or missing X-API-Key header")


class RecipeIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    ingredients: list[str] = Field(default_factory=list)
    # None (field omitted) means the client predates steps and its write
    # must not wipe steps saved by newer clients; [] explicitly clears.
    steps: list[str] | None = None
    # Client-side edit time (epoch ms); upserts older than the stored row
    # are ignored so replayed offline edits can't clobber newer ones.
    updated_at: int = Field(gt=0)

    def clean_ingredients(self) -> list[str]:
        return [i.strip() for i in self.ingredients if i.strip()]

    def clean_steps(self) -> list[str] | None:
        if self.steps is None:
            return None
        # Steps may contain internal newlines; only trim the edges.
        return [s.strip() for s in self.steps if s.strip()]


class KeepAddIn(BaseModel):
    items: list[str] = Field(min_length=1)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "keep": keep.client.status()}


@app.get("/recipes", dependencies=[Depends(require_api_key)])
def list_recipes() -> list[dict]:
    return storage.list_recipes()


@app.get("/recipes/{recipe_id}", dependencies=[Depends(require_api_key)])
def get_recipe(recipe_id: str) -> dict:
    recipe = storage.get_recipe(recipe_id)
    if recipe is None:
        raise HTTPException(404, "Recipe not found")
    return recipe


@app.put("/recipes/{recipe_id}", dependencies=[Depends(require_api_key)])
def upsert_recipe(recipe_id: str, body: RecipeIn) -> dict:
    return storage.upsert_recipe(
        recipe_id,
        body.name.strip(),
        body.clean_ingredients(),
        body.updated_at,
        body.clean_steps(),
    )


@app.delete("/recipes/{recipe_id}", status_code=204, dependencies=[Depends(require_api_key)])
def delete_recipe(recipe_id: str) -> None:
    # Idempotent so offline clients can replay deletes safely.
    storage.delete_recipe(recipe_id)


@app.post("/keep/add", dependencies=[Depends(require_api_key)])
def keep_add(body: KeepAddIn) -> dict:
    try:
        result = keep.client.add_items(body.items)
    except keep.KeepUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    return {
        "added": len(result["added"]),
        "skipped": len(result["skipped"]),
        "skipped_items": result["skipped"],
    }

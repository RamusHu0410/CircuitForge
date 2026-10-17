"""Circuit generation endpoint (placeholder until AI generation is implemented)."""

import logging
import uuid

from fastapi import APIRouter

from app.schemas.circuit import GenerateRequest, GenerateResponse

router = APIRouter(tags=["generation"])
logger = logging.getLogger(__name__)


@router.post("/generate", response_model=GenerateResponse, summary="Generate a schematic from a prompt")
def generate(request: GenerateRequest) -> GenerateResponse:
    request_id = uuid.uuid4().hex
    # Log size only; prompts may describe proprietary designs.
    logger.info("generate request %s: %d characters", request_id, len(request.prompt))
    return GenerateResponse(
        request_id=request_id,
        status="not_implemented",
        message="Prompt received. Schematic generation is not implemented yet; no files were created.",
        prompt=request.prompt,
    )

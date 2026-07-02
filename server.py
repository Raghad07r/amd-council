# server.py — مجلس مستشار أمد للوعي المالي | FastAPI + OpenRouter Edition

import os
import json
import asyncio
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

# ── إعدادات OpenRouter ──────────────────────────────────────────
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL   = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")

client = AsyncOpenAI(
    api_key=OPENROUTER_API_KEY,
    base_url="https://openrouter.ai/api/v1",
    default_headers={
        "HTTP-Referer": "https://amd-financial-council.app",
        "X-Title":      "AMD Financial Council",
    },
)

# ── تعريف الوكلاء ────────────────────────────────────────────────
from agents.prompts import PLANNER_PROMPT, RISK_PROMPT, BEHAVIOR_PROMPT

AGENTS = [
    {
        "id":        "planner",
        "shortName": "سلمان",
        "role":      "مخطط مالي",
        "color":     "#1D9E75",
        "prompt":    PLANNER_PROMPT,
        "keywords":  ["ميزانية", "ادخار", "خطة", "راتب", "دخل", "مصاريف", "إنفاق", "توفير", "طوارئ", "أولويات", "تخطيط", "نفقات", "قرض", "دين"],
    },
    {
        "id":        "risk",
        "shortName": "نورة",
        "role":      "محللة مخاطر",
        "color":     "#185FA5",
        "prompt":    RISK_PROMPT,
        "keywords":  ["استثمار", "أسهم", "عقار", "ذهب", "مخاطر", "صندوق", "عائد", "بورصة", "محفظة", "سوق", "ودائع", "تقييم", "خسارة", "ربح"],
    },
    {
        "id":        "behavior",
        "shortName": "فهد",
        "role":      "خبير سلوك",
        "color":     "#B86A0A",
        "prompt":    BEHAVIOR_PROMPT,
        "keywords":  ["عادات", "سلوك", "إسراف", "تبذير", "اندفاع", "نفسي", "شراء", "تسوق", "إدمان", "تحفيز", "التزام", "تسويف", "خوف", "قلق", "عاطفي"],
    },
]

# ── FastAPI App ──────────────────────────────────────────────────
app = FastAPI(title="مجلس مستشار أمد للوعي المالي")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── التوجيه الذكي: هل يجب أن يرد هذا المستشار؟ ─────────────────
async def should_agent_respond(agent: dict, query: str, council_context: str) -> bool:
    query_lower = query.lower()

    # فحص سريع بالكلمات المفتاحية
    keyword_match = any(kw in query_lower for kw in agent["keywords"])
    if keyword_match:
        return True

    # سؤال النموذج
    eval_prompt = f"""أنت {agent['shortName']} ({agent['role']}).
السؤال التالي: "{query}"
هل هذا السؤال يتعلق بتخصصك مباشرة أو بشكل ذي صلة؟
أجب فقط بـ: نعم أو لا"""

    try:
        response = await client.chat.completions.create(
            model=OPENROUTER_MODEL,
            messages=[{"role": "user", "content": eval_prompt}],
            max_tokens=5,
            temperature=0.0,
        )
        answer = response.choices[0].message.content.strip()
        return "نعم" in answer
    except Exception:
        return True


# ── بث رد الوكيل ────────────────────────────────────────────────
async def stream_agent_response(
    agent: dict,
    messages: list,
    council_context: str,
) -> AsyncGenerator[str, None]:
    """يبث توكنز الوكيل عبر SSE."""

    system = agent["prompt"]
    if council_context:
        system += f"\n\nردود زملائك في المجلس حتى الآن:\n{council_context}\nيمكنك التعليق على آرائهم، الاتفاق، الاعتراض، أو إضافة زاوية جديدة."

    # تعليمات صارمة لمنع تسرب التفكير
    system += """

تعليمات صارمة:
- لا تكتب أفكارك أو خطوات تحليلك أو ما تنوي فعله.
- لا تكتب أي جملة تبدأ بـ "سأقوم" أو "دعني" أو "أولاً سأفكر" أو ما شابهها.
- لا تكتب أي نص بالإنجليزية إطلاقاً.
- اكتب الجواب النهائي مباشرة، بالعربية فقط، في 2-4 جمل."""

    openai_messages = [
        {"role": "system", "content": system},
        *[{"role": m["role"], "content": m["content"]} for m in messages],
    ]

    stream = await client.chat.completions.create(
        model=OPENROUTER_MODEL,
        messages=openai_messages,
        max_tokens=500,
        temperature=0.7,
        stream=True,
    )

    async for chunk in stream:
        token = chunk.choices[0].delta.content or ""
        if token:
            yield token


# ── SSE helper ──────────────────────────────────────────────────
def sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


# ── المسار الرئيسي ──────────────────────────────────────────────
@app.post("/api/council")
async def council_endpoint(request: Request):
    body = await request.json()
    messages = body.get("messages", [])

    if not messages:
        return StreamingResponse(
            iter([sse({"type": "error", "message": "messages array required"})]),
            media_type="text/event-stream",
        )

    if not OPENROUTER_API_KEY:
        return StreamingResponse(
            iter([sse({"type": "error", "message": "❌ OPENROUTER_API_KEY غير موجود في ملف .env"})]),
            media_type="text/event-stream",
        )

    last_user_msg = next(
        (m["content"] for m in reversed(messages) if m["role"] == "user"), ""
    )

    async def event_generator():
        council_responses: list[dict] = []
        council_context = ""
        skipped_agents: list[dict] = []

        try:
            for agent in AGENTS:
                yield sse({"type": "evaluating", "agentId": agent["id"]})

                should_respond = await should_agent_respond(agent, last_user_msg, council_context)

                if not should_respond:
                    # ✅ إصلاح المشكلة 3: لا نرسل agent_skipped هنا، نجمعهم ونرسلهم لاحقاً
                    skipped_agents.append(agent)
                    continue

                # ─ أعلن بدء الوكيل ─
                yield sse({
                    "type":      "agent_start",
                    "agentId":   agent["id"],
                    "agentName": agent["shortName"],
                    "role":      agent["role"],
                    "color":     agent["color"],
                })

                # ─ بث الرد ─
                full_text = ""
                async for token in stream_agent_response(agent, messages, council_context):
                    full_text += token
                    yield sse({"type": "token", "agentId": agent["id"], "token": token})

                # ─ انتهاء الوكيل ─
                yield sse({"type": "agent_done", "agentId": agent["id"]})

                council_responses.append({**agent, "text": full_text})
                council_context += f"[{agent['shortName']} - {agent['role']}]: {full_text}\n"

                await asyncio.sleep(0.2)

            # ✅ إصلاح المشكلة 1: إذا لم يرد أحد، نجبر المستشار الأنسب على الرد
            if not council_responses:
                # اختر المستشار الأول (سلمان) كـ fallback افتراضي
                fallback_agent = AGENTS[0]

                yield sse({
                    "type":      "agent_start",
                    "agentId":   fallback_agent["id"],
                    "agentName": fallback_agent["shortName"],
                    "role":      fallback_agent["role"],
                    "color":     fallback_agent["color"],
                })

                full_text = ""
                # prompt مخصص للأسئلة خارج التخصص
                fallback_agent_with_general = dict(fallback_agent)
                fallback_agent_with_general["prompt"] = fallback_agent["prompt"] + """

إذا كان السؤال ليس في صميم تخصصك تماماً، أجب بشكل عام مفيد من منظورك المالي، وأشر للمستخدم بأن يوجه سؤالاً أكثر تحديداً إذا أراد رأياً متخصصاً."""

                async for token in stream_agent_response(fallback_agent_with_general, messages, ""):
                    full_text += token
                    yield sse({"type": "token", "agentId": fallback_agent["id"], "token": token})

                yield sse({"type": "agent_done", "agentId": fallback_agent["id"]})
                council_responses.append({**fallback_agent, "text": full_text})

                # أرسل الوكلاء المتخطين بعد انتهاء الرد الفعلي
                for skipped in skipped_agents:
                    if skipped["id"] != fallback_agent["id"]:
                        yield sse({"type": "agent_skipped", "agentId": skipped["id"], "agentName": skipped["shortName"]})
            else:
                # أرسل الوكلاء المتخطين بعد انتهاء كل الردود
                for skipped in skipped_agents:
                    yield sse({"type": "agent_skipped", "agentId": skipped["id"], "agentName": skipped["shortName"]})

            yield sse({"type": "council_done"})

        except Exception as e:
            err = str(e)
            msg = "حدث خطأ في الاتصال بـ OpenRouter."
            if "401" in err:
                msg = "❌ API Key غير صحيح. تحقق من OPENROUTER_API_KEY في ملف .env"
            elif "429" in err:
                msg = "⏳ تجاوزت حصة النموذج المجاني. انتظر دقيقة أو غيّر النموذج في .env"
            elif "402" in err:
                msg = "💳 رصيد OpenRouter غير كافٍ."
            yield sse({"type": "error", "message": msg})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Health Check ─────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {
        "status":   "ok",
        "project":  "AMD Financial Council",
        "provider": "OpenRouter",
        "model":    OPENROUTER_MODEL,
        "key_set":  bool(OPENROUTER_API_KEY),
        "routing":  "dynamic",
    }


# ── Static Files ─────────────────────────────────────────────────
app.mount("/", StaticFiles(directory="public", html=True), name="static")


# ── تشغيل مباشر ─────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 3000))
    print(f"""
╔══════════════════════════════════════════════════════╗
║   مجلس مستشار أمد للوعي المالي                      ║
║   هاكاثون أمد 2026 — FastAPI + OpenRouter Edition    ║
╠══════════════════════════════════════════════════════╣
║   Server  : http://localhost:{port}                     ║
║   Provider: OpenRouter (Dynamic Routing)             ║
║   Model   : {OPENROUTER_MODEL[:40].ljust(40)} ║
║   Key Set : {'✓ موجود' if OPENROUTER_API_KEY else '✗ مفقود — أضفه في .env'}{''.ljust(20)} ║
╚══════════════════════════════════════════════════════╝
    """)
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True)

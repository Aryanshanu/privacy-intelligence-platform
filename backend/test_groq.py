import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

key = os.environ.get("GROQ_API_KEY", "")
print(f"Key prefix: {key[:10]}")

client = OpenAI(
    api_key=key,
    base_url="https://api.groq.com/openai/v1",
)

try:
    response = client.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[{"role": "user", "content": "Say hello in one word."}],
    )
    print("Response:", response.choices[0].message.content)
except Exception as e:
    print(f"Error: {e}")

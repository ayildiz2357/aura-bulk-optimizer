import { OpenAI } from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateSEOData(
  productTitle: string,
  productDescription: string,
  toneOfVoice: string = "Professional",
  extraInstructions: string = "",
  generateMainDescription: boolean = false
) {
  let prompt = `
    You are an E-commerce SEO Expert and Copywriter.
    Generate a compelling SEO Title (max 70 chars) and an SEO Meta Description (max 160 chars) for the following product.
    
    Guidelines:
    - Tone of Voice: ${toneOfVoice}
    - Additional Instructions: ${extraInstructions || "None."}
  `;

  if (generateMainDescription) {
    prompt += `
    - ALSO generate a high-converting, visually appealing HTML product description. 
    - The HTML should use basic tags like <p>, <ul>, <li>, and <strong>. 
    - It should highlight the key benefits and fit the requested Tone of Voice.
    
    Respond ONLY with a JSON object in this format:
    {
      "seoTitle": "...",
      "seoDescription": "...",
      "mainDescriptionHtml": "..."
    }
    `;
  } else {
    prompt += `
    Respond ONLY with a JSON object in this format:
    {
      "seoTitle": "...",
      "seoDescription": "..."
    }
    `;
  }

  prompt += `
    Product Title: ${productTitle}
    Current Product Description: ${productDescription || "No description provided."}
  `;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("Failed to generate SEO data");

  return JSON.parse(content) as { seoTitle: string; seoDescription: string; mainDescriptionHtml?: string };
}

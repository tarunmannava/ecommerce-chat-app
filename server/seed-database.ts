import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings} from "@langchain/google-genai"

import { StructuredOutputParser } from "@langchain/core/output_parsers"
import { z } from "zod"
import { MongoClient } from "mongodb"
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb"
import "dotenv/config"
import { ca } from "zod/v4/locales"

const client = new MongoClient(process.env.MONGODB_ATLAS_URI as string)

const llm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash", 
    temperature: 0.7,
    apiKey: process.env.GOOGLE_API_KEY as string})

const itemSchema = z.object({
  item_id: z.string(),                    
  item_name: z.string(),                  
  item_description: z.string(),           
  brand: z.string(),                      
  manufacturer_address: z.object({        
    street: z.string(),                   
    city: z.string(),                     
    state: z.string(),                    
    postal_code: z.string(),              
    country: z.string(),                 
  }),
  prices: z.object({                      
    full_price: z.number(),               
    sale_price: z.number(),               
  }),
  categories: z.array(z.string()),        
  user_reviews: z.array(                  
    z.object({
      review_date: z.string(),            
      rating: z.number(),                 
      comment: z.string(),                
    })
  ),
  notes: z.string(),                      
})


type Item = z.infer<typeof itemSchema>


// Ensure itemSchema is a ZodType and compatible with StructuredOutputParser
const parser = StructuredOutputParser.fromZodSchema(itemSchema as z.ZodType<any>)

async function setupDatabaseAndCollection(): Promise<void> {
  console.log("Setting up database and collection...")
  const db = client.db("inventory_database")
  const collections = await db.listCollections({ name: "items"}).toArray()
  if(collections.length ===0) {
    await db.createCollection("items")
    console.log("Created 'items' collection in 'inventory_database' database")
  }
  else {
    console.log(" 'items' collection already exists in 'inventory_database' database ")
  }
}

async function createVectorSearchIndex(): Promise<void> {
     try {
      const db = client.db("inventory_database")
      const collection = db.collection("items")
      await collection.dropIndexes()
      const vectorSearchIdx = {
        name: "vector_index",
        type: "vectorSearch",
        definition: {
          "fields": [
            {
            "type": "vector",
            "path": "embedding",
            "numdimensions": 768,
            "similarity": "cosine"
            }
          ]
        }
      }
      console.log("Creating vector search index")
      await collection.createSearchIndex(vectorSearchIdx);
      console.log("successfully created vector search index");
     }
     catch (error) {
      console.error("Failed to create vector search index",error)
     }
}

async function generateSyntheticData(): Promise<Item[]> {
  const prompt = `you are a helpful assistant that generates furniture store item data. generate 10 furniture store items. each record should
  include the following fields: item_id, item_name, item_description, brand, manufacturer_address, prices, categories, user_reviews, notes. ensure variety in the data and realistic values 
  ${parser.getFormatInstructions()}`
  console.log("Generating synthetic data..")

  const response = await llm.invoke(prompt)
  try {
    const parsed = await parser.parse(response.content as string)
    if (Array.isArray(parsed)) {
      return parsed as Item[]
    } else if (parsed) {
      return [parsed as Item]
    } else {
      throw new Error("Parsed data is empty")
    }
  } catch (err) {
    console.error("Failed to parse synthetic data", err)
    return []
  }
}

async function createItemSummary(item: Item): Promise<string> {
  return new Promise((resolve) => {
    const manufacturesDetails = `Made in ${item.manufacturer_address.country}`
    const categories = item.categories.join(",")
    const userReviews = item.user_reviews.map((review)=> 
    `Rated ${review.rating} on ${review.review_date}: ${review.comment}`)
    .join(" ")
    const basicInfo = `${item.item_name} ${item.item_description} from the brand ${item.brand}`
    const price = `At full price it costs: $${item.prices.full_price} USD,
     Onsale it costs ${item.prices.sale_price} USD`
    const notes = item.notes 
    const summary = `${basicInfo}, Manufacturer: ${manufacturesDetails},
    Categories: ${categories}, Reviews: ${userReviews}, Price: ${price}, Notes: ${notes}`
    resolve(summary)

  })
}

async function seedDatabase(): Promise<void> {
  try {
    await client.connect()
    await client.db("admin").command({ping:1})
    console.log("You successfully connected to MongoDB Atlas")

    await setupDatabaseAndCollection()
    await createVectorSearchIndex()

    const db = client.db("inventory_database")
    const collection = db.collection("items")
    await collection.deleteMany({})
    console.log("Cleared existing documents in 'items' collection")

    const syntheticData = await generateSyntheticData()

    const recordsWithSummaries = await Promise.all(
      syntheticData.map(async (record: Item) => ({
        pageContent: await createItemSummary(record),
        metadata: { ...record }
      }))
    )

    for (const record of recordsWithSummaries) {
      await MongoDBAtlasVectorSearch.fromDocuments(
        [record],
        new GoogleGenerativeAIEmbeddings(
          {
            apiKey: process.env.GOOGLE_API_KEY as string,
            modelName: "text-embedding-004"
          }
        ),
        {
          collection,
          indexName: "vector_index",
          textKey: "embedding_text",
          embeddingKey: "embedding"
        }
      )
      console.log("successfully processed and saved record", record.metadata.item_id  )
    }

    
  }

  catch(error) {
    console.error("",error)
  }
}
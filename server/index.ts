import 'dotenv/config'
import express, { Express, Request, Response } from 'express'
import { MongoClient } from 'mongodb'
import { callAgent } from './agent'


const app: Express = express()

import cors from 'cors'
app.use(cors())
app.use(express.json())


const client = new MongoClient(process.env.MONGODB_ATLAS_URI as string)
async function starteServer() {
    try {
        await client.connect()
        await client.db('admin').command({ ping: 1 })
        console.log('Successfully connected to MongoDB Atlas!')
        app.get('/',(req: Request, res: Response) => {res.send('LangGraph Agent Server')})

        app.post('/chat', async (req:Request, res: Response)=> {
            const initialMessage = req.body.message
            const threadId = Date.now().toString()
            console.log(initialMessage)
            try {
                const response = await callAgent(client,initialMessage,threadId)
            }

            catch (error) {
                console.error('Error starting conversation',error)
                res.status(500).json({error: 'Internal server error'})
            }

        })

        app.post('/chat/:threadId', async (req:Request, res: Response)=> {
            const {threadId} = req.params
            const {message} = req.body
            try {
                const response = await callAgent(client,message,threadId)
                res.json({response})
            }
            catch (error) { 
                console.error('Error in chat',error)
                res.status(500).json({error: 'Internal server error'})
            }
    }) 
    
    const PORT = process.env.PORT || 8000
    app.listen(PORT, () => {
        console.log(`server is running on port ${PORT}`)
    })

}

    catch (error) {
        console.error('Error connecting to MongoDB',error)
        process.exit(1)
    }
}

starteServer()


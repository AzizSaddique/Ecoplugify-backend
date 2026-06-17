const { MongoClient } = require('mongodb');

// Your MongoDB URI
const uri = "mongodb+srv://ecoplugify_user:Ecoplugify123@cluster0.rwqanpx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

async function testConnection() {
    console.log('\n🔍 Testing MongoDB Connection...\n');
    
    const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
    });
    
    try {
        await client.connect();
        console.log('✅ Connected to MongoDB Atlas successfully!');
        
        // Get server info
        const admin = client.db().admin();
        const serverInfo = await admin.serverInfo();
        console.log(`📡 MongoDB Version: ${serverInfo.version}`);
        
        // List databases
        const dbs = await admin.listDatabases();
        console.log(`📚 Available databases: ${dbs.databases.map(db => db.name).join(', ')}`);
        
        // Create/use database
        const db = client.db('ecoplugify');
        
        // Create a test collection
        const collection = db.collection('test');
        await collection.insertOne({
            message: 'Connection successful',
            timestamp: new Date(),
            test: true
        });
        console.log('✅ Test document inserted');
        
        // Read it back
        const doc = await collection.findOne({ test: true });
        console.log('✅ Test document retrieved:', doc);
        
        // Clean up
        await collection.deleteMany({ test: true });
        console.log('✅ Cleanup complete');
        
        console.log('\n🎉 MongoDB is fully functional!\n');
        
    } catch (error) {
        console.error('❌ Connection failed:', error.message);
        console.log('\nPossible issues:');
        console.log('1. Check IP whitelist in MongoDB Atlas');
        console.log('2. Verify username/password');
        console.log('3. Check network firewall');
    } finally {
        await client.close();
    }
}

testConnection();
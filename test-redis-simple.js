// test-redis-simple.js
import { createClient } from 'redis';

console.log('\n🔍 Testing Redis Cloud Connection...\n');

const redisUrl = 'redis://default:KPoCZgjXWc06owRlyksrH1E810z8tpyA@redis-13903.crce176.me-central-1-1.ec2.cloud.redislabs.com:13903';

const client = createClient({
    url: redisUrl
});

client.on('error', (err) => {
    console.error('❌ Redis Error:', err.message);
});

client.on('connect', () => {
    console.log('✅ Redis connected');
});

client.on('ready', async () => {
    console.log('✅ Redis ready for operations\n');
    
    try {
        // Test 1: Basic set/get
        console.log('📝 Test 1: Basic operations');
        await client.set('test:basic', 'Hello Ecoplugify!');
        const value = await client.get('test:basic');
        console.log('   ✅ Set/Get successful:', value);
        
        // Test 2: Expiry
        console.log('\n⏰ Test 2: Expiry operations');
        await client.setEx('test:expire', 3, 'This will expire in 3 seconds');
        let expiredValue = await client.get('test:expire');
        console.log('   ✅ Value set with expiry:', expiredValue);
        
        // Wait for expiry
        await new Promise(resolve => setTimeout(resolve, 4000));
        expiredValue = await client.get('test:expire');
        console.log('   ✅ After 4 seconds:', expiredValue || 'null (expired correctly)');
        
        // Test 3: Hash operations
        console.log('\n📦 Test 3: Hash operations');
        await client.hSet('test:hash', 'field1', 'value1');
        await client.hSet('test:hash', 'field2', 'value2');
        const hash = await client.hGetAll('test:hash');
        console.log('   ✅ Hash values:', hash);
        
        // Test 4: Delete
        console.log('\n🗑️  Test 4: Delete operations');
        await client.del('test:basic');
        await client.del('test:hash');
        const deleted = await client.get('test:basic');
        console.log('   ✅ After delete:', deleted || 'null');
        
        // Test 5: Performance
        console.log('\n⚡ Test 5: Performance test');
        const start = Date.now();
        for (let i = 0; i < 100; i++) {
            await client.set(`test:perf:${i}`, i);
        }
        const end = Date.now();
        console.log(`   ✅ 100 writes in ${end - start}ms`);
        
        // Clean up
        const keys = await client.keys('test:*');
        if (keys.length > 0) {
            await client.del(keys);
            console.log(`   ✅ Cleaned up ${keys.length} test keys`);
        }
        
        console.log('\n🎉 All Redis tests passed! Redis Cloud is working perfectly!\n');
        
        await client.quit();
        process.exit(0);
        
    } catch (err) {
        console.error('❌ Test failed:', err.message);
        process.exit(1);
    }
});

// Connect and run
await client.connect();
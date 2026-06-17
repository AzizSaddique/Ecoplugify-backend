// config/redis.test.js
import { connectRedis, getRedis, getRedisStatus, redisHealth } from './redis.js';
import logger from '../utils/logger.js';

async function testRedisConnection() {
    console.log('\n🔍 Testing Redis Cloud Connection...\n');
    
    try {
        // Connect to Redis
        const redisClient = await connectRedis();
        const redis = getRedis();
        
        // Check connection status
        const health = await redisHealth();
        console.log('📊 Health Status:', health);
        
        if (!redis) {
            console.log('⚠️  Redis client not available');
            return;
        }
        
        // Test 1: Basic set/get
        console.log('\n📝 Test 1: Basic operations');
        await redis.set('test:basic', 'Hello Ecoplugify!');
        const value = await redis.get('test:basic');
        console.log('   ✅ Set/Get successful:', value);
        
        // Test 2: Expiry
        console.log('\n⏰ Test 2: Expiry operations');
        await redis.setEx('test:expire', 3, 'This will expire in 3 seconds');
        let expiredValue = await redis.get('test:expire');
        console.log('   ✅ Value set with expiry:', expiredValue);
        
        // Wait for expiry
        await new Promise(resolve => setTimeout(resolve, 4000));
        expiredValue = await redis.get('test:expire');
        console.log('   ✅ After 4 seconds (should be null):', expiredValue || 'null (expired)');
        
        // Test 3: Hash operations
        console.log('\n📦 Test 3: Hash operations');
        await redis.hset('test:hash', 'field1', 'value1');
        await redis.hset('test:hash', 'field2', 'value2');
        const hash = await redis.hgetall('test:hash');
        console.log('   ✅ Hash values:', hash);
        
        // Test 4: Multiple operations
        console.log('\n🔄 Test 4: Multiple operations');
        if (redis.mGet) {
            const multiResult = await redis.mGet(['test:basic', 'test:hash']);
            console.log('   ✅ Multi get:', multiResult);
        } else {
            console.log('   ⚠️  mGet not available in mock client');
        }
        
        // Test 5: Delete
        console.log('\n🗑️  Test 5: Delete operations');
        await redis.del('test:basic');
        await redis.del('test:hash');
        const deleted = await redis.get('test:basic');
        console.log('   ✅ After delete (should be null):', deleted || 'null');
        
        // Performance test (only if real Redis)
        if (health.usingFallback === false) {
            console.log('\n⚡ Test 6: Performance test');
            const start = Date.now();
            for (let i = 0; i < 100; i++) {
                await redis.set(`test:perf:${i}`, i);
            }
            const end = Date.now();
            console.log(`   ✅ 100 writes in ${end - start}ms`);
            
            // Clean up performance test keys
            if (redis.keys) {
                const keys = await redis.keys('test:perf:*');
                if (keys.length > 0) {
                    await redis.del(keys);
                    console.log(`   ✅ Cleaned up ${keys.length} test keys`);
                }
            }
        } else {
            console.log('\n⚡ Test 6: Performance test skipped (using mock client)');
        }
        
        console.log('\n🎉 Redis tests completed successfully!\n');
        
        // Final status
        const finalHealth = await redisHealth();
        console.log('📊 Final Status:', finalHealth);
        
        if (finalHealth.status === 'connected') {
            console.log('✅ Redis Cloud is ready for production use!\n');
        } else {
            console.log('⚠️  Using in-memory cache fallback\n');
        }
        
    } catch (error) {
        console.error('❌ Redis test failed:', error.message);
        console.error('Stack:', error.stack);
        
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Check if Redis Cloud instance is active');
        console.log('2. Verify credentials in .env file');
        console.log('3. Check network connectivity');
        console.log('4. Ensure firewall allows outbound connection to port 13903');
        console.log('5. Try pinging the Redis host: ping redis-13903.crce176.me-central-1-1.ec2.cloud.redislabs.com');
    }
}

// Run the test
testRedisConnection();
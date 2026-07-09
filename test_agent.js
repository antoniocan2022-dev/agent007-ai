console.log('Developer agent test started');

// Simple test functions
function add(a, b) {
    return a + b;
}

function multiply(a, b) {
    return a * b;
}

// Run tests
const test1 = add(2, 3);
const test2 = multiply(4, 5);

console.log('Addition test (2 + 3):', test1);
console.log('Multiplication test (4 * 5):', test2);

// Verify results
if (test1 === 5 && test2 === 20) {
    console.log('✅ Developer agent is working correctly!');
} else {
    console.log('❌ Developer agent test failed');
}

console.log('Developer agent test completed');
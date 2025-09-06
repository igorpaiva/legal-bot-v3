export class HumanLikeDelay {
  constructor() {
    this.minResponseDelay = parseInt(process.env.BOT_RESPONSE_DELAY_MIN) || 1000;
    this.maxResponseDelay = parseInt(process.env.BOT_RESPONSE_DELAY_MAX) || 5000;
    this.minTypingDelay = parseInt(process.env.BOT_TYPING_DELAY_MIN) || 500;
    this.maxTypingDelay = parseInt(process.env.BOT_TYPING_DELAY_MAX) || 2000;
    
    // Reading delay configuration
    this.readingSpeedWPM = parseInt(process.env.BOT_READING_SPEED_WPM) || 250;
    this.complexityThreshold = parseInt(process.env.BOT_READING_COMPLEXITY_THRESHOLD) || 200;
    this.minReadingDelay = parseInt(process.env.BOT_READING_MIN_DELAY) || 500;
    this.maxReadingDelay = parseInt(process.env.BOT_READING_MAX_DELAY) || 45000;
  }

  /**
   * Generate a random delay between min and max values
   */
  getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Wait for a human-like delay before responding
   */
  async waitBeforeResponse() {
    const delay = this.getRandomDelay(this.minResponseDelay, this.maxResponseDelay);
    console.log(`Waiting ${delay}ms before responding (human-like delay)`);
    await this.sleep(delay);
  }

  /**
   * Simulate typing indicator for a human-like duration
   */
  async simulateTyping(chat) {
    const typingDelay = this.getRandomDelay(this.minTypingDelay, this.maxTypingDelay);
    
    try {
      // Start typing indicator
      await chat.sendStateTyping();
      console.log(`Simulating typing for ${typingDelay}ms`);
      
      // Wait for the typing duration
      await this.sleep(typingDelay);
      
      // Clear typing indicator
      await chat.clearState();
    } catch (error) {
      console.error('Error simulating typing:', error);
      // If typing simulation fails, just wait the delay
      await this.sleep(typingDelay);
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get a random delay for reading a message (based on message length)
   */
  getReadingDelay(messageLength) {
    // Calculate reading time based on realistic human reading speed
    // Average word length: ~4.5 characters (accounting for spaces and punctuation)
    
    const estimatedWords = messageLength / 4.5;
    const baseReadingTimeMs = (estimatedWords / this.readingSpeedWPM) * 60 * 1000;
    
    // Add complexity factor for longer messages (people read slower when processing more info)
    let complexityMultiplier = 1;
    if (messageLength > this.complexityThreshold) complexityMultiplier = 1.2;
    if (messageLength > this.complexityThreshold * 2.5) complexityMultiplier = 1.4;
    if (messageLength > this.complexityThreshold * 5) complexityMultiplier = 1.6;
    
    const adjustedReadingTime = baseReadingTimeMs * complexityMultiplier;
    
    // Add natural variance (±40%)
    const variance = adjustedReadingTime * 0.4;
    const randomVariance = (Math.random() - 0.5) * 2 * variance;
    
    const finalReadingTime = adjustedReadingTime + randomVariance;
    
    // Set reasonable bounds using configurable values
    const minDelay = Math.max(this.minReadingDelay, messageLength * 2); // At least 2ms per character
    const maxDelay = Math.min(this.maxReadingDelay, messageLength * 20); // At most 20ms per character
    
    const delay = Math.max(minDelay, Math.min(maxDelay, finalReadingTime));
    
    return Math.floor(delay);
  }

  /**
   * Simulate reading a message before responding
   */
  async simulateReading(messageLength) {
    const readingDelay = this.getReadingDelay(messageLength);
    const estimatedWords = Math.round(messageLength / 4.5);
    
    console.log(`Simulating reading for ${readingDelay}ms (${messageLength} chars, ~${estimatedWords} words)`);
    await this.sleep(readingDelay);
  }

  /**
   * Get random delays for different times of day to seem more human
   */
  getTimeBasedDelay() {
    const hour = new Date().getHours();
    
    // Faster responses during business hours (9 AM - 6 PM)
    if (hour >= 9 && hour <= 18) {
      return this.getRandomDelay(1000, 3000);
    }
    
    // Slower responses during evening/night (6 PM - 11 PM)
    if (hour >= 18 && hour <= 23) {
      return this.getRandomDelay(2000, 8000);
    }
    
    // Very slow or no responses during night/early morning (11 PM - 9 AM)
    // This could be used to make the bot seem like it's "sleeping"
    return this.getRandomDelay(5000, 15000);
  }

  /**
   * Simulate human-like availability (sometimes delayed responses)
   */
  async simulateAvailability() {
    const hour = new Date().getHours();
    
    // Small chance of being "busy" during business hours
    if (hour >= 9 && hour <= 18 && Math.random() < 0.1) {
      const busyDelay = this.getRandomDelay(10000, 30000); // 10-30 seconds
      console.log(`Simulating being busy for ${busyDelay}ms`);
      await this.sleep(busyDelay);
    }
    
    // Higher chance of delayed response during evening
    if (hour >= 18 && hour <= 23 && Math.random() < 0.2) {
      const eveningDelay = this.getRandomDelay(15000, 60000); // 15-60 seconds
      console.log(`Simulating evening delay for ${eveningDelay}ms`);
      await this.sleep(eveningDelay);
    }
    
    // Much higher chance of very delayed response during night
    if ((hour >= 23 || hour <= 9) && Math.random() < 0.7) {
      const nightDelay = this.getRandomDelay(60000, 300000); // 1-5 minutes
      console.log(`Simulating night delay for ${nightDelay}ms`);
      await this.sleep(nightDelay);
    }
  }

  /**
   * Complete human-like message processing simulation
   */
  async processMessageLikeHuman(chat, messageLength) {
    // Check availability first
    await this.simulateAvailability();
    
    // Simulate reading the message
    await this.simulateReading(messageLength);
    
    // Simulate typing
    await this.simulateTyping(chat);
    
    // Final delay before sending
    const finalDelay = this.getTimeBasedDelay();
    console.log(`Final delay before response: ${finalDelay}ms`);
    await this.sleep(finalDelay);
  }
}

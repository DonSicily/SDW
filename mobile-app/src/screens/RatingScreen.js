import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import API from '../services/api';

export default function RatingScreen({ route, navigation }) {
  const { rideId } = route.params;
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (rating === 0) {
      Alert.alert('Pick a rating', 'Tap a star to rate your driver.');
      return;
    }
    setSubmitting(true);
    try {
      await API.put(`/rides/${rideId}/rate`, { rating, review });
      Alert.alert('Thanks!', 'Your rating has been submitted.');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.message || 'Could not submit rating');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>How was your ride?</Text>
      <Text style={styles.subtitle}>Rate your driver</Text>

      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity key={n} onPress={() => setRating(n)}>
            <Text style={[styles.star, n <= rating && styles.starFilled]}>★</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        style={styles.input}
        placeholder="Leave a review (optional)"
        value={review}
        onChangeText={setReview}
        multiline
        numberOfLines={4}
      />

      <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
        <Text style={styles.submitText}>{submitting ? 'Submitting…' : 'Submit'}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.skipText}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#f5f5f5', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#777', textAlign: 'center', marginBottom: 24 },
  stars: { flexDirection: 'row', justifyContent: 'center', marginBottom: 24 },
  star: { fontSize: 44, color: '#ddd', marginHorizontal: 4 },
  starFilled: { color: '#ffb800' },
  input: {
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 14,
    fontSize: 15,
    minHeight: 90,
    textAlignVertical: 'top',
    marginBottom: 20
  },
  submitBtn: { backgroundColor: '#ff6600', padding: 16, borderRadius: 10, alignItems: 'center' },
  submitText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  skipText: { textAlign: 'center', color: '#999', marginTop: 16, fontSize: 14 }
});
